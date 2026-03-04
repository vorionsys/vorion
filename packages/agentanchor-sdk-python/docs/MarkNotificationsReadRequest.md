# MarkNotificationsReadRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**notification_ids** | **List[str]** |  | [optional] 
**mark_all** | **bool** |  | [optional] 

## Example

```python
from agentanchor.models.mark_notifications_read_request import MarkNotificationsReadRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MarkNotificationsReadRequest from a JSON string
mark_notifications_read_request_instance = MarkNotificationsReadRequest.from_json(json)
# print the JSON string representation of the object
print(MarkNotificationsReadRequest.to_json())

# convert the object into a dict
mark_notifications_read_request_dict = mark_notifications_read_request_instance.to_dict()
# create an instance of MarkNotificationsReadRequest from a dict
mark_notifications_read_request_from_dict = MarkNotificationsReadRequest.from_dict(mark_notifications_read_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


