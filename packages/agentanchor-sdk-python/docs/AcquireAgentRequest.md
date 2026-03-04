# AcquireAgentRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**listing_id** | **UUID** |  | 

## Example

```python
from agentanchor.models.acquire_agent_request import AcquireAgentRequest

# TODO update the JSON string below
json = "{}"
# create an instance of AcquireAgentRequest from a JSON string
acquire_agent_request_instance = AcquireAgentRequest.from_json(json)
# print the JSON string representation of the object
print(AcquireAgentRequest.to_json())

# convert the object into a dict
acquire_agent_request_dict = acquire_agent_request_instance.to_dict()
# create an instance of AcquireAgentRequest from a dict
acquire_agent_request_from_dict = AcquireAgentRequest.from_dict(acquire_agent_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


